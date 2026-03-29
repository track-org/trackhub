---
name: solis-energy
description: Query Solis solar inverter data and check for solar export conditions. Use when asked about solar generation, current power output, grid export/import, daily energy totals, or when to charge an EV. Also provides the export alert check used by cron jobs.
---

# Solis Energy

Read-only queries against the Solis Cloud API for Don's home solar inverter. Provides daily generation/export/import stats, live inverter power, and an export-alert check that a cron job uses to nudge Don to charge his EV when surplus solar is being exported to the grid.

## Overview

- **Source of truth**: Solis is the authoritative source for solar generation and grid export/import. Do NOT assume the inverter's whole-home load reading is complete — it only records during daylight production hours (no battery).
- **Read-only**: These scripts never write to any API. They only query Solis Cloud and read OpenClaw cron run history.

## Required Environment Variables

All credentials are read from the workspace `.env` file (loaded automatically by the scripts via `load_env()`).

| Variable | Purpose |
|---|---|
| `SOLIS_API_URL` | Solis Cloud API base URL (e.g. `https://www.soliscloud.com`) |
| `SOLIS_KEY_ID` | API key ID |
| `SOLIS_KEY_SECRET` | API key secret (used for HMAC signing) |
| `SOLIS_PLANT_ID` | Numeric plant/station ID (required for `now` command) |

The scripts discover the env file by:
1. Checking `SOLIS_ENV_FILE` env var (explicit override)
2. Falling back to `<workspace>/.env` (resolved relative to script location — three levels up from `scripts/`)

## Commands

All commands output JSON to stdout. Set `EXPORT_ALERT_CRON_JOB_ID` when running the export alert check.

### Solar status

```bash
python3 {baseDir}/scripts/solis_status.py today       # Today's generation, export, import, self-consumption
python3 {baseDir}/scripts/solis_status.py yesterday    # Yesterday's stats
python3 {baseDir}/scripts/solis_status.py now          # Current inverter power and status
```

**`today` / `yesterday`** output fields:
- `generation_kwh` — total solar generated
- `grid_sold_kwh` — energy exported to grid
- `grid_purchased_kwh` — energy imported from grid
- `home_load_kwh` — home consumption
- `self_consumed_kwh` — solar used directly (not exported)

**`now`** output fields:
- `inverter_sn` — inverter serial number
- `status` — current operating state
- `current_power_kw` — live AC output (kW)
- `last_seen` — timestamp of last data update

### Export alert check

```bash
EXPORT_ALERT_CRON_JOB_ID=<id> python3 {baseDir}/scripts/export_alert_check.py
# or:
python3 {baseDir}/scripts/export_alert_check.py --cron-job-id <id>
```

## Export Alert Logic

The cron job runs this check every 30 minutes during the daytime window (06:00–21:30 Dublin). It evaluates three conditions:

| Condition | Threshold | Purpose |
|---|---|---|
| Solar output | ≥ 0.2 kW | Ensure panels are producing (not just residual) |
| Grid export | ≥ 0.5 kW | Surplus beyond house demand |
| Cooldown | 4 hours since last delivered alert | Don't spam |

When all three are true, `should_alert` is `true` and the `message` field contains the text to send. The cron agent reads this JSON and either replies `NO_REPLY` or forwards the message to Don via WhatsApp.

**JSON output fields:**
- `timestamp` — unix epoch of check
- `should_alert` — boolean
- `daylight_like`, `exporting`, `cooldown_ok` — individual condition results
- `solar_output_kw`, `export_kw`, `house_load_kw` — current readings
- `cooldown_remaining_seconds` — time until cooldown expires
- `message` — alert text (or null)

## Cron Integration

The cron job (`Solar export WhatsApp nudge`) uses an agent session that:
1. Runs the export alert check script
2. Parses the JSON output
3. If `should_alert` is false → replies `NO_REPLY` (no message sent)
4. If `should_alert` is true → sends the `message` field to Don via WhatsApp

To set up a new cron job:
```bash
openclaw cron add \
  --name "Solar export WhatsApp nudge" \
  --cron "0,30 6-21 * * *" \
  --tz "Europe/Dublin" \
  --session main \
  --system-event "Check for live solar export and only message Don on WhatsApp when appropriate.

Workflow:
1. Run: EXPORT_ALERT_CRON_JOB_ID=<job-id> python3 {baseDir}/scripts/export_alert_check.py
2. Parse the JSON result.
3. If should_alert is false, reply exactly NO_REPLY.
4. If should_alert is true, reply with the message field verbatim.
5. Do not post anything to Slack or any other channel.
6. Do not send more than one WhatsApp message within any 4 hour period; the helper script already enforces that statefully."
```

## Energy Tariff Notes

For cost calculations, tariff rates are documented in TOOLS.md:
- Night: 24.63 c/kWh (23:00–08:00)
- Day: 38.33 c/kWh (08:00–23:00)
- Peak: 42.93 c/kWh (17:00–19:00)

## Failure Handling

If a Solis API call fails:
1. Check that `SOLIS_API_URL`, `SOLIS_KEY_ID`, and `SOLIS_KEY_SECRET` are set in `.env`
2. Check network connectivity — the API is external
3. The scripts retry up to 3 times with 0s, 1.2s, 2.5s delays on HTTP 429 (rate limited)
4. Non-429 HTTP errors or API-level error codes cause an immediate exit with a message to stderr
5. After 3 consecutive rate-limit retries, the script exits with failure

## Important Notes

- **Solis is source of truth** for solar generation and grid export/import figures
- **Inverter records only during daylight** — no battery means no nighttime data
- **Don't trust whole-home load from Solis** — it only measures while the inverter is active
- For total home consumption, cross-reference with **Emporia** (the source of truth for consumption)
- The `pac` field in live data is in **kW** (not W) based on observed values
- Grid power sign convention: **negative** = importing from grid, **positive** = exporting to grid
